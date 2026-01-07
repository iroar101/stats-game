import './style.css';
import { Game } from './game/Game';

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root');
}

new Game(root);
