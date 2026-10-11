export function widgetEscapeAction({ defaultPrevented, hasModal, hasExpandedDetails }: {
  defaultPrevented: boolean;
  hasModal: boolean;
  hasExpandedDetails: boolean;
}) {
  if (defaultPrevented || hasModal) return "IGNORE";
  return hasExpandedDetails ? "COLLAPSE_DETAILS" : "CLOSE_WIDGET";
}
