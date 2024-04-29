/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { v4 as uuidv4 } from 'uuid';
import { memoize, once } from 'lodash';
import {
  BehaviorSubject,
  EMPTY,
  from,
  fromEvent,
  Observable,
  of,
  Subscription,
  throwError,
} from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  shareReplay,
  skip,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs';
import { estypes } from '@elastic/elasticsearch';
import { i18n } from '@kbn/i18n';
import { PublicMethodsOf } from '@kbn/utility-types';
import type { HttpSetup, IHttpFetchError } from '@kbn/core-http-browser';
import { type Start as InspectorStart, RequestAdapter } from '@kbn/inspector-plugin/public';

import {
  ApplicationStart,
  CoreStart,
  DocLinksStart,
  ExecutionContextSetup,
  IUiSettingsClient,
  ThemeServiceSetup,
  ToastsSetup,
} from '@kbn/core/public';

import { BatchedFunc, BfetchPublicSetup, DISABLE_BFETCH } from '@kbn/bfetch-plugin/public';
import { toMountPoint } from '@kbn/kibana-react-plugin/public';
import { AbortError, KibanaServerError } from '@kbn/kibana-utils-plugin/public';
import { BfetchRequestError } from '@kbn/bfetch-error';
import { createEsError, isEsError, renderSearchError } from '@kbn/search-errors';
import {
  ENHANCED_ES_SEARCH_STRATEGY,
  IAsyncSearchOptions,
  IKibanaSearchRequest,
  IKibanaSearchResponse,
  isRunningResponse,
  ISearchOptions,
  ISearchOptionsSerializable,
  pollSearch,
  UI_SETTINGS,
  type SanitizedConnectionRequestParams,
} from '../../../common';
import { SearchUsageCollector } from '../collectors';
import { SearchTimeoutError, TimeoutErrorMode } from './timeout_error';
import { SearchSessionIncompleteWarning } from './search_session_incomplete_warning';
import { toPartialResponseAfterTimeout } from './to_partial_response';
import { ISessionService, SearchSessionState } from '../session';
import { SearchResponseCache } from './search_response_cache';
import { SearchAbortController } from './search_abort_controller';
import { SearchConfigSchema } from '../../../config';
import type { SearchServiceStartDependencies } from '../search_service';
import { createRequestHash } from './create_request_hash';

export interface SearchInterceptorDeps {
  bfetch: BfetchPublicSetup;
  http: HttpSetup;
  executionContext: ExecutionContextSetup;
  uiSettings: IUiSettingsClient;
  startServices: Promise<[CoreStart, object, unknown]>;
  toasts: ToastsSetup;
  usageCollector?: SearchUsageCollector;
  session: ISessionService;
  theme: ThemeServiceSetup;
  searchConfig: SearchConfigSchema;
}

const MAX_CACHE_ITEMS = 50;
const MAX_CACHE_SIZE_MB = 10;

export class SearchInterceptor {
  private uiSettingsSubs: Subscription[] = [];
  private searchTimeout: number;
  private bFetchDisabled: boolean;
  private readonly responseCache: SearchResponseCache = new SearchResponseCache(
    MAX_CACHE_ITEMS,
    MAX_CACHE_SIZE_MB
  );

  /**
   * Observable that emits when the number of pending requests changes.
   * @internal
   */
  private pendingCount$ = new BehaviorSubject(0);

  /**
   * @internal
   */
  private application!: ApplicationStart;
  private docLinks!: DocLinksStart;
  private batchedFetch!: BatchedFunc<
    { request: IKibanaSearchRequest; options: ISearchOptionsSerializable },
    IKibanaSearchResponse
  >;
  private inspector!: InspectorStart;

  /*
   * @internal
   */
  constructor(private readonly deps: SearchInterceptorDeps) {
    this.deps.http.addLoadingCountSource(this.pendingCount$);

    this.deps.startServices.then(([coreStart, depsStart]) => {
      this.application = coreStart.application;
      this.docLinks = coreStart.docLinks;
      this.inspector = (depsStart as SearchServiceStartDependencies).inspector;
    });

    this.batchedFetch = deps.bfetch.batchedFunction({
      url: '/internal/bsearch',
    });

    this.searchTimeout = deps.uiSettings.get(UI_SETTINGS.SEARCH_TIMEOUT);
    this.bFetchDisabled = deps.uiSettings.get(DISABLE_BFETCH);

    this.uiSettingsSubs.push(
      deps.uiSettings.get$(UI_SETTINGS.SEARCH_TIMEOUT).subscribe((timeout: number) => {
        this.searchTimeout = timeout;
      }),
      deps.uiSettings.get$(DISABLE_BFETCH).subscribe((bFetchDisabled: boolean) => {
        this.bFetchDisabled = bFetchDisabled;
      })
    );
  }

  public stop() {
    this.responseCache.clear();
    this.uiSettingsSubs.forEach((s) => s.unsubscribe());
  }

  /*
   * @returns `TimeoutErrorMode` indicating what action should be taken in case of a request timeout based on license and permissions.
   * @internal
   */
  private getTimeoutMode() {
    return this.application.capabilities.advancedSettings?.save
      ? TimeoutErrorMode.CHANGE
      : TimeoutErrorMode.CONTACT;
  }

  private createRequestHash$(
    request: IKibanaSearchRequest,
    options: IAsyncSearchOptions
  ): Observable<string | undefined> {
    const { sessionId } = options;
    // Preference is used to ensure all queries go to the same set of shards and it doesn't need to be hashed
    // https://www.elastic.co/guide/en/elasticsearch/reference/current/search-shard-routing.html#shard-and-node-preference
    const { preference, ...params } = request.params || {};
    const hashOptions = {
      ...params,
      sessionId,
    };

    if (!sessionId) return of(undefined); // don't use cache if doesn't belong to a session
    const sessionOptions = this.deps.session.getSearchOptions(options.sessionId);
    if (sessionOptions?.isRestore) return of(undefined); // don't use cache if restoring a session

    return from(createRequestHash(hashOptions));
  }

  /*
   * @returns `Error` a search service specific error or the original error, if a specific error can't be recognized.
   * @internal
   */
  private handleSearchError(
    e: KibanaServerError | AbortError,
    requestBody: estypes.SearchRequest,
    options?: IAsyncSearchOptions,
    isTimeout?: boolean
  ): Error {
    if (isTimeout || e.message === 'Request timed out') {
      // Handle a client or a server side timeout
      const err = new SearchTimeoutError(e, this.getTimeoutMode());

      // Show the timeout error here, so that it's shown regardless of how an application chooses to handle errors.
      // The timeout error is shown any time a request times out, or once per session, if the request is part of a session.
      this.showTimeoutError(err, options?.sessionId);
      return err;
    }

    if (e instanceof AbortError || e instanceof BfetchRequestError) {
      // In the case an application initiated abort, throw the existing AbortError, same with BfetchRequestErrors
      return e;
    }

    if (isEsError(e)) {
      const openInInspector = () => {
        const requestId = options?.inspector?.id ?? uuidv4();
        const requestAdapter = options?.inspector?.adapter ?? new RequestAdapter();
        if (!options?.inspector?.adapter) {
          const requestResponder = requestAdapter.start(
            i18n.translate('data.searchService.anonymousRequestTitle', {
              defaultMessage: 'Request',
            }),
            {
              id: requestId,
            }
          );
          requestResponder.json(requestBody);
          requestResponder.error({ json: e.attributes });
        }
        this.inspector.open(
          {
            requests: requestAdapter,
          },
          {
            options: {
              initialRequestId: requestId,
              initialTabs: ['clusters', 'response'],
            },
          }
        );
      };
      return createEsError(
        e,
        openInInspector,
        {
          application: this.application,
          docLinks: this.docLinks,
        },
        options?.indexPattern
      );
    }

    return e instanceof Error ? e : new Error(e.message);
  }

  private getSerializableOptions(options?: ISearchOptions) {
    const { sessionId, ...requestOptions } = options || {};

    const serializableOptions: ISearchOptionsSerializable = {};
    const combined = {
      ...requestOptions,
      ...this.deps.session.getSearchOptions(sessionId),
    };

    if (combined.sessionId !== undefined) serializableOptions.sessionId = combined.sessionId;
    if (combined.isRestore !== undefined) serializableOptions.isRestore = combined.isRestore;
    if (combined.retrieveResults !== undefined)
      serializableOptions.retrieveResults = combined.retrieveResults;
    if (combined.legacyHitsTotal !== undefined)
      serializableOptions.legacyHitsTotal = combined.legacyHitsTotal;
    if (combined.strategy !== undefined) serializableOptions.strategy = combined.strategy;
    if (combined.isStored !== undefined) serializableOptions.isStored = combined.isStored;
    if (combined.isSearchStored !== undefined)
      serializableOptions.isSearchStored = combined.isSearchStored;
    if (combined.executionContext !== undefined) {
      serializableOptions.executionContext = combined.executionContext;
    }

    return serializableOptions;
  }

  /**
   * @internal
   * Creates a new pollSearch that share replays its results
   */
  private runSearch$(
    { id, ...request }: IKibanaSearchRequest,
    options: IAsyncSearchOptions,
    searchAbortController: SearchAbortController
  ) {
    const { sessionId, strategy } = options;

    const search = () => {
      const [{ isSearchStored }, afterPoll] = searchTracker?.beforePoll() ?? [
        { isSearchStored: false },
        ({ isSearchStored: boolean }) => {},
      ];
      return this.runSearch(
        { id, ...request },
        {
          ...options,
          ...this.deps.session.getSearchOptions(sessionId),
          abortSignal: searchAbortController.getSignal(),
          isSearchStored,
        }
      )
        .then((result) => {
          afterPoll({ isSearchStored: result.isStored ?? false });
          return result;
        })
        .catch((err) => {
          afterPoll({ isSearchStored: false });
          throw err;
        });
    };

    const searchTracker = this.deps.session.isCurrentSession(sessionId)
      ? this.deps.session.trackSearch({
          abort: () => searchAbortController.abort(),
          poll: async () => {
            if (id) {
              await search();
            }
          },
        })
      : undefined;

    // track if this search's session will be send to background
    // if yes, then we don't need to cancel this search when it is aborted
    let isSavedToBackground =
      this.deps.session.isCurrentSession(sessionId) && this.deps.session.isStored();
    const savedToBackgroundSub =
      this.deps.session.isCurrentSession(sessionId) &&
      this.deps.session.state$
        .pipe(
          skip(1), // ignore any state, we are only interested in transition x -> BackgroundLoading
          filter(
            (state) =>
              this.deps.session.isCurrentSession(sessionId) &&
              state === SearchSessionState.BackgroundLoading
          ),
          take(1)
        )
        .subscribe(() => {
          isSavedToBackground = true;
        });

    const sendCancelRequest = once(() => {
      this.deps.http.delete(`/internal/search/${strategy}/${id}`, { version: '1' });
    });

    const cancel = () => id && !isSavedToBackground && sendCancelRequest();

    // Async search requires a series of requests
    // 1) POST /<index pattern>/_async_search/
    // 2..n) GET /_async_search/<async search identifier>
    //
    // First request contains useful request params for tools like Inspector.
    // Preserve and project first request params into responses.
    let firstRequestParams: SanitizedConnectionRequestParams;

    return pollSearch(search, cancel, {
      pollInterval: this.deps.searchConfig.asyncSearch.pollInterval,
      ...options,
      abortSignal: searchAbortController.getSignal(),
    }).pipe(
      tap((response) => {
        if (!firstRequestParams && response.requestParams) {
          firstRequestParams = response.requestParams;
        }

        id = response.id;

        if (!isRunningResponse(response)) {
          searchTracker?.complete();
        }
      }),
      map((response) => {
        return firstRequestParams
          ? {
              ...response,
              requestParams: firstRequestParams,
            }
          : response;
      }),
      catchError((e: Error) => {
        searchTracker?.error();
        cancel();
        return throwError(e);
      }),
      finalize(() => {
        searchAbortController.cleanup();
        if (savedToBackgroundSub) {
          savedToBackgroundSub.unsubscribe();
        }
      }),
      // This observable is cached in the responseCache.
      // Using shareReplay makes sure that future subscribers will get the final response

      shareReplay(1)
    );
  }

  /**
   * @internal
   * @throws `AbortError` | `ErrorLike`
   */
  private runSearch(
    request: IKibanaSearchRequest,
    options?: ISearchOptions
  ): Promise<IKibanaSearchResponse> {
    const { abortSignal } = options || {};

    if (this.bFetchDisabled) {
      const { executionContext, strategy, ...searchOptions } = this.getSerializableOptions(options);
      return this.deps.http
        .post(`/internal/search/${strategy}${request.id ? `/${request.id}` : ''}`, {
          version: '1',
          signal: abortSignal,
          context: executionContext,
          body: JSON.stringify({
            ...request,
            ...searchOptions,
          }),
        })
        .catch((e: IHttpFetchError<KibanaServerError>) => {
          if (e?.body) {
            throw e.body;
          } else {
            throw e;
          }
        }) as Promise<IKibanaSearchResponse>;
    } else {
      const { executionContext, ...rest } = options || {};
      return this.batchedFetch(
        {
          request,
          options: this.getSerializableOptions({
            ...rest,
            executionContext: this.deps.executionContext.withGlobalContext(executionContext),
          }),
        },
        abortSignal
      );
    }
  }

  /**
   * @internal
   * Creates a new search observable and a corresponding search abort controller
   * If requestHash is defined, tries to return them first from cache.
   */
  private getSearchResponse$(
    request: IKibanaSearchRequest,
    options: IAsyncSearchOptions,
    requestHash?: string
  ) {
    const cached = requestHash ? this.responseCache.get(requestHash) : undefined;

    const searchAbortController =
      cached?.searchAbortController || new SearchAbortController(this.searchTimeout);

    // Create a new abort signal if one was not passed. This fake signal will never be aborted,
    // So the underlaying search will not be aborted, even if the other consumers abort.
    searchAbortController.addAbortSignal(options.abortSignal ?? new AbortController().signal);
    const response$ = cached?.response$ || this.runSearch$(request, options, searchAbortController);

    if (requestHash && !this.responseCache.has(requestHash)) {
      this.responseCache.set(requestHash, {
        response$,
        searchAbortController,
      });
    }

    return {
      response$,
      searchAbortController,
    };
  }

  /**
   * Searches using the given `search` method. Overrides the `AbortSignal` with one that will abort
   * either when the request times out, or when the original `AbortSignal` is aborted. Updates
   * `pendingCount$` when the request is started/finalized.
   *
   * @param request
   * @options
   * @returns `Observable` emitting the search response or an error.
   */
  public search({ id, ...request }: IKibanaSearchRequest, options: IAsyncSearchOptions = {}) {
    const searchOptions = {
      ...options,
    };
    if (!searchOptions.strategy) {
      searchOptions.strategy = ENHANCED_ES_SEARCH_STRATEGY;
    }

    const { sessionId, abortSignal } = searchOptions;

    return this.createRequestHash$(request, searchOptions).pipe(
      switchMap((requestHash) => {
        const { searchAbortController, response$ } = this.getSearchResponse$(
          request,
          searchOptions,
          requestHash
        );

        this.pendingCount$.next(this.pendingCount$.getValue() + 1);

        // Abort the replay if the abortSignal is aborted.
        // The underlaying search will not abort unless searchAbortController fires.
        const aborted$ = (abortSignal ? fromEvent(abortSignal, 'abort') : EMPTY).pipe(
          map(() => {
            throw new AbortError();
          })
        );

        return response$.pipe(
          takeUntil(aborted$),
          catchError((e) => {
            // If we aborted (search:timeout advanced setting) and there was a partial response, return it instead of just erroring out
            if (searchAbortController.isTimeout()) {
              return from(
                this.runSearch(request, { ...searchOptions, retrieveResults: true })
              ).pipe(
                tap(() =>
                  this.handleSearchError(e, request?.params?.body ?? {}, searchOptions, true)
                ),
                map(toPartialResponseAfterTimeout)
              );
            }
            return throwError(
              this.handleSearchError(
                e,
                request?.params?.body ?? {},
                searchOptions,
                searchAbortController.isTimeout()
              )
            );
          }),
          tap((response) => {
            const isSearchInScopeOfSession =
              sessionId && sessionId === this.deps.session.getSessionId();
            if (
              isSearchInScopeOfSession &&
              this.deps.session.isRestore() &&
              response.isRestored === false
            ) {
              this.showRestoreWarning(sessionId);
            }
          }),
          finalize(() => {
            this.pendingCount$.next(this.pendingCount$.getValue() - 1);
          })
        );
      })
    );
  }

  private showTimeoutErrorToast = (e: SearchTimeoutError, sessionId?: string) => {
    this.deps.toasts.addDanger({
      title: 'Timed out',
      text: toMountPoint(e.getErrorMessage(this.application), { theme$: this.deps.theme.theme$ }),
    });
  };

  private showTimeoutErrorMemoized = memoize(
    this.showTimeoutErrorToast,
    (_: SearchTimeoutError, sessionId?: string) => {
      return sessionId;
    }
  );

  private showRestoreWarningToast = (sessionId?: string) => {
    this.deps.toasts.addWarning(
      {
        title: 'Your search session is still running',
        text: toMountPoint(SearchSessionIncompleteWarning(this.docLinks), {
          theme$: this.deps.theme.theme$,
        }),
      },
      {
        toastLifeTimeMs: 60000,
      }
    );
  };

  private showRestoreWarning = memoize(this.showRestoreWarningToast);

  /**
   * Show one error notification per session.
   * @internal
   */
  private showTimeoutError = (e: SearchTimeoutError, sessionId?: string) => {
    if (sessionId) {
      this.showTimeoutErrorMemoized(e, sessionId);
    } else {
      this.showTimeoutErrorToast(e, sessionId);
    }
  };

  public showError(e: Error) {
    if (e instanceof AbortError || e instanceof SearchTimeoutError) {
      // The SearchTimeoutError is shown by the interceptor in getSearchError (regardless of how the app chooses to handle errors)
      return;
    }

    const searchErrorDisplay = renderSearchError(e);

    if (searchErrorDisplay) {
      this.deps.toasts.addDanger({
        title: searchErrorDisplay.title,
        text: toMountPoint(searchErrorDisplay.body, { theme$: this.deps.theme.theme$ }),
      });
    } else {
      this.deps.toasts.addError(e, {
        title: 'Search Error',
      });
    }
  }
}

export type ISearchInterceptor = PublicMethodsOf<SearchInterceptor>;
