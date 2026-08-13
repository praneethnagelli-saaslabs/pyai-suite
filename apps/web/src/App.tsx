import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { DashboardPage } from "@/pages/Dashboard";
import { CallIQPage } from "@/pages/CallIQ";
import { ScribPage } from "@/pages/Scrib";
import { BriefPage } from "@/pages/Brief";
import { SimulatorPage } from "@/pages/Simulator";
import { PlaygroundPage } from "@/pages/Playground";
import { RunsPage } from "@/pages/Runs";
import { ProvidersPage } from "@/pages/Providers";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<DashboardPage />} />
            <Route path="calliq" element={<CallIQPage />} />
            <Route path="scrib" element={<ScribPage />} />
            <Route path="brief" element={<BriefPage />} />
            <Route path="simulator" element={<SimulatorPage />} />
            <Route path="playground" element={<PlaygroundPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
