import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: canvas/WebGL effects must not run twice (react-dev guide).
createRoot(document.getElementById('root')!).render(<App />)
