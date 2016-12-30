export default function (kibana) {

  return new kibana.Plugin({
    uiExports: {
      visTypes: [
        'plugins/pivot_table_vis/pivot_table_vis'
      ]
    }
  });

}
