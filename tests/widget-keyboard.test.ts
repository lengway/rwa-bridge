import assert from "node:assert/strict";
import test from "node:test";
import { widgetEscapeAction } from "../lib/widget-keyboard";

test("Escape must not tear down the widget during approval or a transaction dialog", () => {
  assert.equal(widgetEscapeAction({ defaultPrevented: false, hasModal: true, hasExpandedDetails: false }), "IGNORE");
  assert.equal(widgetEscapeAction({ defaultPrevented: true, hasModal: false, hasExpandedDetails: false }), "IGNORE");
});

test("Escape closes disclosures before closing the host widget", () => {
  assert.equal(widgetEscapeAction({ defaultPrevented: false, hasModal: false, hasExpandedDetails: true }), "COLLAPSE_DETAILS");
  assert.equal(widgetEscapeAction({ defaultPrevented: false, hasModal: false, hasExpandedDetails: false }), "CLOSE_WIDGET");
});
