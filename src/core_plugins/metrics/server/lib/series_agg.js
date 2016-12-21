import _ from 'lodash';

const basic = fnName => targetSeries => {
  const data = [];
  _.zip(...targetSeries).forEach(row => {
    const key = row[0][0];
    const values = row.map(r => r[1]);
    const fn = _[fnName] || (() => null);
    data.push([key, fn(values)]);
  });
  return [data];
};

const overall = fnName => targetSeries => {
  const fn = _[fnName];
  const keys = [];
  const values = [];
  _.zip(...targetSeries).forEach(row => {
    keys.push(row[0][0]);
    values.push(fn(row.map(r => r[1])));
  });
  return [keys.map(k => [k, fn(values)])];
};


export default {
  sum: basic('sum'),
  max: basic('max'),
  min: basic('min'),
  mean: basic('mean'),

  overall_max: overall('max'),
  overall_min: overall('min'),
  overall_avg: overall('mean'),
  overall_sum: overall('sum'),

  cumlative_sum(targetSeries) {
    const data = [];
    let sum = 0;
    _.zip(...targetSeries).forEach(row => {
      const key = row[0][0];
      sum += _.sum(row.map(r => r[1]));
      data.push([key, sum]);
    });
    return [data];
  }

};
