import { BenchmarkPage } from "./components/BenchmarkPage";
import { CorePlayground } from "./components/CorePlayground";
import { StudentPage } from "./components/StudentPage";

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/benchmark") {
    return <BenchmarkPage mode="core" />;
  }

  if (pathname === "/tool-benchmark") {
    return <BenchmarkPage mode="tool" />;
  }

  if (pathname === "/student") {
    return <StudentPage />;
  }

  return <CorePlayground />;
}
