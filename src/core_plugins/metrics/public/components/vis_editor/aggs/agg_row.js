import React from 'react';
import _ from 'lodash';
import AddDeleteButtons from '../../add_delete_buttons';
import Tooltip from '../../tooltip';
export default (props) => {

  let iconClassName = 'fa fa-eye-slash';
  let iconRowClassName = 'vis_editor__agg_row-icon';
  const last = _.last(props.siblings);
  if (last.id === props.model.id) {
    iconClassName = 'fa fa-eye';
    iconRowClassName += ' last';
  }

  let dragHandle;
  if (!props.disableDelete) {
    dragHandle = (
      <div>
        <Tooltip text="Sort">
          <div className="vis_editor__agg_sort thor__button-outlined-default sm">
            <i className="fa fa-sort"></i>
      </div>
      </Tooltip>
      </div>
    );
  }

  return (
    <div className="vis_editor__agg_row">
      <div className="vis_editor__agg_row-item">
        <div className={iconRowClassName}>
          <i className={iconClassName}></i>
        </div>
        {props.children}
        { dragHandle }
        <AddDeleteButtons
          onAdd={props.onAdd}
          onDelete={props.onDelete}
          disableDelete={props.disableDelete}/>
      </div>
    </div>
  );
};
