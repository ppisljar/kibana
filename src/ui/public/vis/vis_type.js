import VisSchemasProvider from './schemas';

export default function VisTypeFactory(Private) {
  const VisTypeSchemas = Private(VisSchemasProvider);

  class VisType {
    constructor(opts) {
      opts = opts || {};

      this.name = opts.name;
      this.title = opts.title;
      this.shortTitle = opts.shortTitle;
      this.responseConverter = opts.responseConverter;
      this.hierarchicalData = opts.hierarchicalData || false;
      this.icon = opts.icon;
      this.description = opts.description;
      this.shortDescription = opts.shortDescription;
      this.category = opts.category || VisType.CATEGORY.OTHER;
      this.isExperimental = opts.isExperimental;
      this.schemas = opts.schemas || new VisTypeSchemas();
      this.params = opts.params || {};
      this.requiresSearch = opts.requiresSearch == null ? true : opts.requiresSearch; // Default to true unless otherwise specified
      this.fullEditor = opts.fullEditor == null ? false : opts.fullEditor;
      this.implementsRenderComplete = opts.implementsRenderComplete || false;

      if (!this.params.optionTabs) {
        this.params.optionTabs = [
          { name: 'options', title: 'Options', editor: this.params.editor }
        ];
      }
    }

    createRenderbot() {
      throw new Error('not implemented');
    }
  }

  VisType.CATEGORY = {
    BASIC: 'basic',
    DATA: 'data',
    GRAPHIC: 'graphic',
    MAP: 'map',
    OTHER: 'other',
    TIME: 'time',
  };

  return VisType;
}
