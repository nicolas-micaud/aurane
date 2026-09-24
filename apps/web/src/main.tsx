import { render } from 'preact';
import { App } from './ui/App.js';
import { setupPwa } from './pwa.js';
import './styles.css';

render(<App />, document.getElementById('app')!);
setupPwa();
