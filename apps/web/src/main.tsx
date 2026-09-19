import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/auth-context";
import { RequireAuth, RequirePermission } from "@/auth/guards";
import { ToastProvider } from "@/components/ui/toast";
import AppShell from "@/layouts/AppShell";
import AcceptInvite from "@/pages/AcceptInvite";
import AuditLog from "@/pages/AuditLog";
import ChitDetail from "@/pages/ChitDetail";
import ChitNew from "@/pages/ChitNew";
import Chits from "@/pages/Chits";
import Passbook from "@/pages/Passbook";
import CustomerDetail from "@/pages/CustomerDetail";
import CustomerWizard from "@/pages/CustomerWizard";
import Customers from "@/pages/Customers";
import Dashboard from "@/pages/Dashboard";
import DesignSystem from "@/pages/DesignSystem";
import Login from "@/pages/Login";
import UserManagement from "@/pages/UserManagement";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              <Route path="/design-system" element={<DesignSystem />} />

              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<Dashboard />} />
                  <Route element={<RequirePermission anyOf={["customer:view"]} />}>
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/customers/:id" element={<CustomerDetail />} />
                  </Route>
                  <Route element={<RequirePermission anyOf={["customer:edit"]} />}>
                    <Route path="/customers/:id/edit" element={<CustomerWizard />} />
                  </Route>
                  <Route element={<RequirePermission anyOf={["chit:view"]} />}>
                    <Route path="/chits" element={<Chits />} />
                    <Route path="/chits/tickets/:ticketId" element={<Passbook />} />
                    <Route path="/chits/:id" element={<ChitDetail />} />
                  </Route>
                  <Route element={<RequirePermission anyOf={["chit:create"]} />}>
                    <Route path="/chits/new" element={<ChitNew />} />
                  </Route>
                  <Route element={<RequirePermission anyOf={["user:view", "role:view"]} />}>
                    <Route path="/user-management" element={<UserManagement />} />
                  </Route>
                  <Route element={<RequirePermission anyOf={["audit:view"]} />}>
                    <Route path="/audit-log" element={<AuditLog />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
