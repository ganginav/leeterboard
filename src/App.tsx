import { useEffect, useState } from "react";
import Landing from "./components/Landing";
import BoardView from "./components/BoardView";
import { boardIdFromPath } from "./lib/boards";

/** Re-render whenever the path changes (pushState dispatches popstate). */
function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

/** Router: `/b/{id}` shows that board, anything else shows the landing screen. */
export default function App() {
  const path = usePath();
  const boardId = boardIdFromPath(path);
  // key forces a fresh BoardView (state reset) when switching between boards.
  return boardId ? <BoardView key={boardId} boardId={boardId} /> : <Landing />;
}
