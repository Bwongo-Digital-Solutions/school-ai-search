import { createRoot } from 'react-dom/client';

// The design system loads before the app, and the order matters.
//
// Vite emits CSS in the order modules are first imported. With `App` imported first, every
// component's *.module.scss landed ahead of Carbon's stylesheet — so at equal specificity Carbon
// won every override, and things like the header's brand colour silently did nothing.
// Foundations first, then the app's own styles on top of them.
import './styles/carbon.scss';
// The app's own tokens, after Carbon so they can key off the `.cds--g100` class its <Theme> emits.
import './styles/app-tokens.scss';
import './index.css';

import App from './App.tsx';

createRoot(document.getElementById('root')!).render(<App />);
