// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";

vi.mock("../styles/banner.module.css", () => ({ default: {} }));

describe("UpdateBanner", () => {
  let onDismiss: () => void;

  beforeEach(() => {
    onDismiss = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the banner with expected text", () => {
    render(<UpdateBanner onDismiss={onDismiss} />);
    expect(screen.getByText("New version available")).toBeTruthy();
  });

  it("has accessible role status", () => {
    render(<UpdateBanner onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("Refresh button calls window.location.reload", () => {
    const reloadMock = vi.fn();
    vi.stubGlobal("location", { reload: reloadMock });

    render(<UpdateBanner onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Refresh"));
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  it("Dismiss button calls onDismiss prop", () => {
    render(<UpdateBanner onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Dismiss update notification"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
