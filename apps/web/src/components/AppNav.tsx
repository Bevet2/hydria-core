type AppNavProps = {
  current: "playground" | "benchmark" | "tool-benchmark";
};

export function AppNav({ current }: AppNavProps) {
  return (
    <nav className="app-nav">
      <a
        href="/playground"
        className={`app-nav__link ${current === "playground" ? "app-nav__link--active" : ""}`}
      >
        Playground
      </a>
      <a
        href="/benchmark"
        className={`app-nav__link ${current === "benchmark" ? "app-nav__link--active" : ""}`}
      >
        Benchmark Summary
      </a>
      <a
        href="/tool-benchmark"
        className={`app-nav__link ${current === "tool-benchmark" ? "app-nav__link--active" : ""}`}
      >
        Tool Benchmark
      </a>
    </nav>
  );
}
