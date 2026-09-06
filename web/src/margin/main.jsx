import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarginApp } from './MarginApp.js';
import './margin.css';

createRoot(document.getElementById('root')).render(React.createElement(MarginApp));
