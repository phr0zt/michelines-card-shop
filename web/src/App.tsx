import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmProvider } from './components/ui/Dialog';
import { PageSpinner } from './components/ui/Feedback';
import { ToastProvider } from './components/ui/Toast';
import { NotFound } from './pages/NotFound';
import { ShopCardPage } from './pages/shop/ShopCardPage';
import { ShopHome } from './pages/shop/ShopHome';
import { ShopLayout } from './pages/shop/ShopLayout';

// The admin area (and its charts) loads separately so shoppers only download the storefront.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const LoginPage = lazy(() => import('./pages/admin/LoginPage'));
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'));
const InventoryPage = lazy(() => import('./pages/admin/InventoryPage'));
const AddCardsPage = lazy(() => import('./pages/admin/AddCardsPage'));
const CardPage = lazy(() => import('./pages/admin/card/CardPage'));
const ReviewPage = lazy(() => import('./pages/admin/ReviewPage'));
const InquiriesPage = lazy(() => import('./pages/admin/InquiriesPage'));
const SalesPage = lazy(() => import('./pages/admin/SalesPage'));
const PurchasesPage = lazy(() => import('./pages/admin/PurchasesPage'));
const PurchasePage = lazy(() => import('./pages/admin/PurchasePage'));
const ReportsPage = lazy(() => import('./pages/admin/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const PrintPage = lazy(() => import('./pages/admin/PrintPage'));

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <Suspense fallback={<PageSpinner />}>
              <Routes>
                <Route element={<ShopLayout />}>
                  <Route index element={<ShopHome />} />
                  <Route path="card/:sku" element={<ShopCardPage />} />
                </Route>
                <Route path="admin/login" element={<LoginPage />} />
                <Route path="admin/print" element={<PrintPage />} />
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="cards" element={<InventoryPage />} />
                  <Route path="cards/new" element={<AddCardsPage />} />
                  <Route path="cards/:id" element={<CardPage />} />
                  <Route path="review" element={<ReviewPage />} />
                  <Route path="inquiries" element={<InquiriesPage />} />
                  <Route path="sales" element={<SalesPage />} />
                  <Route path="purchases" element={<PurchasesPage />} />
                  <Route path="purchases/:id" element={<PurchasePage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound admin />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
