const reds = [
  '#99000E', '#A41926', '#AF333E', '#BB4C56', '#C6666E', '#D17F86', '#DD999E', '#E8B2B6', '#F3CCCE', '#FFE6E6'
];
const greens = [
  '#E5F5F9', '#CBE1E0', '#B2CDC7', '#98BAAF', '#7FA696', '#65927D', '#4C7F65', '#326B4C', '#195733', '#00441B'
];
const blues = [
  '#DEEBF7', '#C6D6E7', '#AEC1D7', '#96ACC8', '#7E97B8', '#6783A9', '#4F6E99', '#37598A', '#1F447A', '#08306B'
];
const yellowtored = [
  '#F8F840', '#EEDA35', '#E4BC2A', '#DB9F1F', '#D18114', '#C8640A', '#D05415', '#D84520', '#E0362B', '#E82736'
];

export default function (percent, colorSchema) {
  switch (colorSchema) {
    case 'reds':
      return reds[9 - percent];
    case 'greens':
      return greens[percent];
    case 'blues':
      return blues[percent];
    case 'yellow to red':
      return yellowtored[percent];
    default:
      const start = 120;
      const end = 360;
      const c = start + (end - start) * percent * 10;

      return `hsl(${c},60%,50%)`;
  }
};
