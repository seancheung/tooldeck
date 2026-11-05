import React from 'react';
import ReactDOM from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import { translate } from './i18n';
import App from './App';
import './styles.css';
document.addEventListener('contextmenu', event => event.preventDefault());
const root = ReactDOM.createRoot(document.getElementById('root')!);
if (isTauri()) {
  root.render(<React.StrictMode><App/></React.StrictMode>);
} else {
  const locale = /^zh(?:-|$)/i.test(navigator.language) ? 'zh-CN' : 'en';
  document.documentElement.lang = locale;
  root.render(<p>{translate(locale, 'Open ToolDeck in its desktop window.')}</p>);
}
