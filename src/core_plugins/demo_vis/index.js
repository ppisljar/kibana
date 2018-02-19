export default function (kibana) {

  return new kibana.Plugin({

    uiExports: {
      visTypes: [
        'plugins/demo_vis/metric_vis'
      ]
    }

  });

}
