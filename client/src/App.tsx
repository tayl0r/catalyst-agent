import { Route, Routes } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import ProjectsPage from "./pages/ProjectsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
    </Routes>
  );
}
