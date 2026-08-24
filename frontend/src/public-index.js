import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import PublicApp from "@/PublicApp";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <PublicApp />
  </React.StrictMode>,
);
