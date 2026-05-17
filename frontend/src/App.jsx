import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Transactions from "./pages/Transactions";
import Categories from "./pages/Categories";
import Recurring from "./pages/Recurring";
import Import from "./pages/Import";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="categories" element={<Categories />} />
          <Route path="recurring" element={<Recurring />} />
          <Route path="import" element={<Import />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
