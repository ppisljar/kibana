import d3 from 'd3';
import $ from 'jquery';
export default function AxisTitleFactory(Private) {

  class AxisTitle {
    constructor(axisConfig, visConfig) {
      this.axisConfig = axisConfig;
      this.visConfig = visConfig;
    }

    render() {
      d3.select(this.axisConfig.get('rootEl')).call(this.draw());
    };

    draw(width, height) {
      const config = this.axisConfig;

      return function (selection) {
        selection.each(function () {
          if (!config.get('show') && !config.get('title.show', false)) return;

          const el = this;
          const titleG = d3.select(el).append('g');

          return titleG
            .append('text')
            .attr('transform', function () {
              if (config.isHorizontal()) {
                return 'translate(' + width / 2 + ',11)';
              }
              return 'translate(11,' + height / 2 + ') rotate(270)';
            })
            .attr('text-anchor', 'middle')
            .text(config.get('title.text'));
        });
      };
    };
  }
  return AxisTitle;
};
