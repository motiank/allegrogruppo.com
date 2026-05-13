import React, { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import Login from "./Login";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import OrderHistory from "./pages/OrderHistory";
import Analytics from "./pages/analytics/index.js";
import Performance from "./pages/Performance";
import Affiliates from "./pages/Affiliates";
import Coupons from "./pages/Coupons";
import Shifts from "./pages/Shifts";
import Employees from "./pages/Employees";
import axios from "axios";
import useCurrentUser, { clearCachedUser } from "./hooks/useCurrentUser";

const RESTMNGR_HOME = "/shift-tabit/employees";

const RestrictByRole = ({ children, allow }) => {
  const { role, loading } = useCurrentUser();
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <p>Loading...</p>
      </div>
    );
  }
  if (role === "restMngr" && !allow.includes("restMngr")) {
    return <Navigate to={RESTMNGR_HOME} replace />;
  }
  return children;
};

const ProtectedRoute = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      try {
        const response = await axios.get("/auth/login", {
          withCredentials: true,
        });
        const isAuth = response.data?.content?.status === "logged-in";
        setIsAuthenticated(isAuth);
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <p>Loading...</p>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const LoginWrapper = () => {
  const navigate = useNavigate();

  const handleLoginSuccess = async () => {
    clearCachedUser();
    try {
      const response = await axios.get("/auth/login", {
        withCredentials: true,
      });
      const role = response.data?.content?.user?.role;
      if (role === "restMngr") {
        navigate(RESTMNGR_HOME);
        return;
      }
    } catch (err) {
      // fall through to default landing
    }
    navigate("/dashboard");
  };

  return <Login onLoginSuccess={handleLoginSuccess} />;
};

const RootRoute = () => {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.role === "restMngr") {
    return <Navigate to={RESTMNGR_HOME} replace />;
  }
  return <Navigate to="/dashboard" replace />;
};

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginWrapper />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <Dashboard />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <OrderHistory />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <Analytics />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/performance"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <Performance />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/affiliates"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <Affiliates />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/coupons"
          element={
            <ProtectedRoute>
              <RestrictByRole allow={[]}>
                <Layout>
                  <Coupons />
                </Layout>
              </RestrictByRole>
            </ProtectedRoute>
          }
        />
        <Route
          path="/shift-tabit"
          element={<Navigate to="/shift-tabit/employees" replace />}
        />
        <Route
          path="/shift-tabit/employees"
          element={
            <ProtectedRoute>
              <Layout>
                <Employees />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/shift-tabit/create-payroll"
          element={
            <ProtectedRoute>
              <Layout>
                <Shifts />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/shifts"
          element={<Navigate to="/shift-tabit/create-payroll" replace />}
        />
        <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
        <Route path="/admin.html" element={<RootRoute />} />
        <Route path="/" element={<RootRoute />} />
        <Route path="*" element={<RootRoute />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
