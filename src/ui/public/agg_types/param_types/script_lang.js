import editorHtml from 'ui/agg_types/controls/script_lang.html';
import StringParamTypesBaseProvider from 'ui/agg_types/param_types/string';
import { GetEnabledScriptingLanguagesProvider } from 'ui/scripting_languages';

export default function ScriptingLangAggParamFactory(Private) {
  const StringAggParam = Private(StringParamTypesBaseProvider);
  const getScriptingLangs = Private(GetEnabledScriptingLanguagesProvider);

  class ScriptingLangAggParam extends StringAggParam {
    constructor(config) {
      super(config);

      this.default = 'painless';
      this.editor = editorHtml;
      this.controller = class ScriptingLangParamController {
        constructor() {
          this.loading = true;

          getScriptingLangs()
            .then(scriptingLangs => {
              this.loading = false;
              this.scriptingLangs = scriptingLangs;
            });
        }
      };
    }
  }

  return ScriptingLangAggParam;
}
