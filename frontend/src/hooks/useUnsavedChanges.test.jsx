import React, { act } from "react";
import { createRoot } from "react-dom/client";
import useUnsavedChanges from "./useUnsavedChanges";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Fixture({ dirty }) {
  useUnsavedChanges(dirty, "Unsaved changes");
  return <a href="#another-page">Leave</a>;
}

const renderFixture = async (dirty) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Fixture dirty={dirty} />));
  return { container, root };
};

afterEach(() => jest.restoreAllMocks());

test("blocks internal navigation when the user keeps unsaved changes", async () => {
  const confirmation = jest.spyOn(window, "confirm").mockReturnValue(false);
  const { container, root } = await renderFixture(true);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  expect(container.querySelector("a").dispatchEvent(event)).toBe(false);
  expect(confirmation).toHaveBeenCalledWith("Unsaved changes");
  await act(async () => root.unmount());
  container.remove();
});

test("does not prompt when the form is clean", async () => {
  const confirmation = jest.spyOn(window, "confirm").mockReturnValue(false);
  const { container, root } = await renderFixture(false);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  container.querySelector("a").dispatchEvent(event);
  expect(confirmation).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  container.remove();
});
