const DESTINATION_CORNERS = Object.freeze([
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]);

function solveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) throw new Error('Calibration points are degenerate');
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function computeHomography(source, destination = DESTINATION_CORNERS) {
  if (source.length !== 4 || destination.length !== 4) throw new Error('Four point pairs are required');
  if (polygonArea(source) < 0.01) throw new Error('Calibration area is too small');
  const matrix = [];
  const values = [];
  source.forEach((point, index) => {
    const target = destination[index];
    matrix.push([point.x, point.y, 1, 0, 0, 0, -target.x * point.x, -target.x * point.y]);
    values.push(target.x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -target.y * point.x, -target.y * point.y]);
    values.push(target.y);
  });
  return [...solveLinearSystem(matrix, values), 1];
}

export function applyHomography(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-10) return null;
  const x = (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator;
  const y = (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

