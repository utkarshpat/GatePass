import { Resources } from "./shared/model.ts";
declare const __GATEPASS_UI_TEST__: boolean;
import { Component, type ReactNode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { usePwa } from "./components.tsx";
import type { PageConfig, PageProps } from "./types.ts";
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="entry-layout">
        <section className="reception-login" role="alert">
          <h1>Unable to open this page</h1>
          <p>
            Reload to reconnect. Check the current status before repeating an
            action.
          </p>
          <button className="primary" onClick={() => location.reload()}>
            Reload page
          </button>
        </section>
      </main>
    ) : (
      this.props.children
    );
  }
}
function Application({
  config,
  Page,
}: {
  config: PageConfig;
  Page: ComponentType<PageProps>;
}) {
  usePwa(config.page !== "email" && !config.manualReception);
  return <Page config={config} />;
}
export function renderPage(Page: ComponentType<PageProps>) {
  const config = JSON.parse(
    document.getElementById("app-config")!.textContent!,
  ) as PageConfig;
  let root = createRoot(document.getElementById("app")!);
  const paint = () =>
    root.render(
      <PageErrorBoundary>
        <Application Page={Page} config={config} />
      </PageErrorBoundary>,
    );
  paint();
  if (__GATEPASS_UI_TEST__)
    Object.assign(window, {
      __gatepassReactTest: {
        unmount: () => root.unmount(),
        remount: () => {
          root = createRoot(document.getElementById("app")!);
          paint();
        },
        diagnostics: () => Resources.diagnostics(),
      },
    });
}
