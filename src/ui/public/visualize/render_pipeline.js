import _ from 'lodash';
import $ from 'jquery';
import { fromExpression } from '../../../../../kibana-extra/canvas/common/lib/ast';
import { interpretAst } from '../../../../../kibana-extra/canvas/public/lib/interpreter';
import { renderFunctionsRegistry } from '../../../../../kibana-extra/canvas/public/lib/render_functions_registry';

export const generateExpression = (vis) => {

  const type = vis.type.name;
  const { aggs, indexPattern, params } = vis;

  if (vis.pipelineExpression) {
    let parts = vis.pipelineExpression.split('|');
    parts = parts.map(part => {
      const parts2 = part.trim().split(' ');
      switch(parts2[0]) {
        case 'aggregate': case 'aggregate_tabify':
          part = `${parts2[0]} ${indexPattern ? `index='${indexPattern.id}'` : ''} aggConfig='${JSON.stringify(aggs)}'`;
          break;
        case 'visualization': case 'visualization_tabify':
          let oldType = _.find(parts2, el => el.startsWith('type='));
          if (oldType) oldType = oldType.split('=')[1].replace('\'', '').replace('\'', '');
          else oldType = type;
          part = `${parts2[0]} type='${oldType}' visConfig='${JSON.stringify(params)}'`;
          break;
        case 'vega':
          part = `vega spec='${JSON.stringify(params.spec)}'`;
          break;
        // case 'pie':
        //   part = `${parts2[0]} visConfig='${JSON.stringify(params)}'`;
        //   break;
      }
      return part.trim();
    });
    return parts.join(' | ');
  }

  if (vis.type.visConfig.defaultExpression) {
    return vis.type.visConfig.defaultExpression(vis);
  }

  return `kibana | aggregate ${indexPattern ? `index='${indexPattern.id}'` : ''} 
  aggConfig='${JSON.stringify(aggs)}' | visualization type='${type}' visConfig='${JSON.stringify(params)}'`;

};

export const createAst = (pipelineExpression) => {
  const ast = fromExpression(pipelineExpression);
  return ast;
};

export const renderPipeline = (el, vis, uiState) => {
  try {
    const ast = fromExpression(vis.pipelineExpression);
    interpretAst(ast).then((renderable) => {
      const domNode = $(el).find('.vis-editor-canvas')[0];
      const renderFunction = renderFunctionsRegistry.get(_.get(renderable, 'as'));
      // pass uiState directly ?
      renderFunction.render(domNode, renderable.value, {
        uiState: uiState,
        vis: vis,
        onDestroy: () => {},
        onResize: () => {},
        done: () => {},
      });
    });
  } catch(e) {
    //console.log(e);
  }
};
