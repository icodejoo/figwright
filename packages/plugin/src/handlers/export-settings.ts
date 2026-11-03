export const validateExportOptions = (format: string, options: object): void => {
  const p = options as Record<string, unknown>;
  if (
    format !== 'SVG' &&
    ['svgOutlineText', 'svgIdAttribute', 'svgSimplifyStroke'].some(key => p[key] !== undefined)
  )
    throw new Error('SVG options require SVG format');
  if (format !== 'PNG' && format !== 'JPG' && p.constraint !== undefined)
    throw new Error('constraint requires PNG or JPG format');
};
