/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { SpacesService } from './create_spaces_service';

export function createSpacesTutorialContextFactory(spacesService: SpacesService) {
  return function spacesTutorialContextFactory(request: any) {
    return {
      spaceId: spacesService.getSpaceId(request),
      isInDefaultSpace: spacesService.isInDefaultSpace(request),
    };
  };
}
