import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/ui";
import { getToken } from "./lib/api";
import ApplicationDetail from "./pages/ApplicationDetail";
import Applications from "./pages/Applications";
import Dashboard from "./pages/Dashboard";
import Deadlines from "./pages/Deadlines";
import Discover from "./pages/Discover";
import Documents from "./pages/Documents";
import FinalReview from "./pages/FinalReview";
import FormMemory from "./pages/FormMemory";
import GeneratedDoc from "./pages/GeneratedDoc";
import InterviewPrep from "./pages/InterviewPrep";
import Login from "./pages/Login";
import Notifications from "./pages/Notifications";
import OpportunityDetail from "./pages/OpportunityDetail";
import ProfilePage from "./pages/Profile";
import References from "./pages/References";
import Research from "./pages/Research";
import Settings from "./pages/Settings";
import Shortlist from "./pages/Shortlist";
import Tasks from "./pages/Tasks";

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  useEffect(() => {
    const h = () => setAuthed(!!getToken());
    window.addEventListener("auth-changed", h);
    return () => window.removeEventListener("auth-changed", h);
  }, []);

  if (!authed)
    return (
      <>
        <Login />
        <Toaster />
      </>
    );
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="discover" element={<Discover />} />
          <Route path="shortlist" element={<Shortlist />} />
          <Route path="opportunities/:id" element={<OpportunityDetail />} />
          <Route path="applications" element={<Applications />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="applications/:id/review" element={<FinalReview />} />
          <Route path="applications/:id/interview" element={<InterviewPrep />} />
          <Route path="deadlines" element={<Deadlines />} />
          <Route path="documents" element={<Documents />} />
          <Route path="form-memory" element={<FormMemory />} />
          <Route path="profile" element={<ProfilePage />} />
                    <Route path="references" element={<References />} />
          <Route path="research" element={<Research />} />
          <Route path="generated/:id" element={<GeneratedDoc />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
