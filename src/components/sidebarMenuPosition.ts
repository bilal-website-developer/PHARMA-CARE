export function clampSidebarMenuPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  menuWidth: number,
  menuHeight: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(x, viewportWidth - menuWidth)),
    top: Math.max(0, Math.min(y, viewportHeight - menuHeight)),
  };
}
