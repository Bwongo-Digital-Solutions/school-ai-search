import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { ChatProvider } from "@/contexts/ChatContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { LicenceProvider } from "@/contexts/LicenceContext";
import { LiveProvider } from "@/contexts/LiveContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import CarbonTheme from "@/components/CarbonTheme";
import Index from "./pages/Index";
import TenantSignup from "./pages/TenantSignup";
import PlatformOwner from "./pages/PlatformOwner";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// `defaultTheme="system"` follows the device unless the reader says otherwise. It was pinned to
// light, which meant a machine set to dark got a light app and no sign that a choice existed.
const App = () => (
  <ThemeProvider defaultTheme="system">
    <CarbonTheme>
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <AuthProvider>
            <SettingsProvider>
              <LicenceProvider>
              <LiveProvider>
                <ChatProvider>
                  <BrowserRouter>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/signup" element={<TenantSignup />} />
                      <Route path="/owner" element={<PlatformOwner />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </BrowserRouter>
                </ChatProvider>
              </LiveProvider>
              </LicenceProvider>
            </SettingsProvider>
          </AuthProvider>
        </NotificationProvider>
      </QueryClientProvider>
    </CarbonTheme>
  </ThemeProvider>
);

export default App;
