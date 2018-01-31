import { calculateObjectHash } from './lib/calculate_object_hash';

// adapted from https://github.com/isaacs/json-stringify-safe/blob/02cfafd45f06d076ac4bf0dd28be6738a07a72f9/stringify.js
function serializer() {
  const stack = [];
  const keys = [];

  const cycleReplacer = function (key, value) {
    if (stack[0] === value) return '[Circular ~]';
    return `[Circular ~.${keys.slice(0, stack.indexOf(value)).join('.')}]`;
  };

  return function (key, value) {
    if (stack.length > 0) {
      const thisPos = stack.indexOf(this);
      ~thisPos ? stack.splice(thisPos + 1) : stack.push(this);
      ~thisPos ? keys.splice(thisPos, Infinity, key) : keys.push(key);
      if (~stack.indexOf(value)) value = cycleReplacer.call(this, key, value);
    }
    else stack.push(value);

    return value;
  };
}

function getUpdateStatus(obj, param) {

  if (!obj._oldStatus) {
    obj._oldStatus = {};
  }

  const hasChangedUsingGenericHashComparison = (name, value) => {
    const currentValue = JSON.stringify(value, serializer());
    if (currentValue !== obj._oldStatus[name]) {
      obj._oldStatus[name] = currentValue;
      return true;
    }
    return false;
  };

  const hasSizeChanged = (currentWidth, currentHeight) => {

    if (!obj._oldStatus.resize) {
      obj._oldStatus.resize = { width: currentWidth, height: currentHeight };
      return true;
    }

    if (currentWidth !== obj._oldStatus.resize.width || currentHeight !== obj._oldStatus.resize.height) {
      obj._oldStatus.resize = { width: currentWidth, height: currentHeight };
      return true;
    }
    return false;
  };

  const hasDataChanged = (visData) => {
    const hash = calculateObjectHash(visData);
    if (hash !== obj._oldStatus.data) {
      obj._oldStatus.data = hash;
      return true;
    }
    return false;
  };

  const time = param.vis.params.timeRange ? param.vis.params.timeRange : param.vis.API.timeFilter.getBounds();
  const width = param.vis.size ? param.vis.size[0] : 0;
  const height = param.vis.size ? param.vis.size[1] : 0;
  return {
    aggs: hasChangedUsingGenericHashComparison('aggs', param.vis.aggs),
    data: hasDataChanged(param.visData),
    params: hasChangedUsingGenericHashComparison('param', param.vis.params),
    resize: hasSizeChanged(width, height),
    time: hasChangedUsingGenericHashComparison('time', time),
    uiState: hasChangedUsingGenericHashComparison('uiState', param.uiState)
  };
}

export { getUpdateStatus };
