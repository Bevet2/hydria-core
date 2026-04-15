import { BenchmarkPage } from "./components/BenchmarkPage";
import { CorePlayground } from "./components/CorePlayground";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/benchmark") {
    return <BenchmarkPage mode="core" />;
  }

  if (pathname === "/tool-benchmark") {
    return <BenchmarkPage mode="tool" />;
  }

  return <CorePlayground />;
}
