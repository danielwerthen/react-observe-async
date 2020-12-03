import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import Todos from './Todos';
import { usePending } from '../src';

function PendingOverlay() {
  const pending = usePending();
  if (!pending) {
    return null;
  }
  return <div className="pending-overlay">Loading...</div>;
}

const App = () => {
  return (
    <div>
      <Todos />
      <PendingOverlay />
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
