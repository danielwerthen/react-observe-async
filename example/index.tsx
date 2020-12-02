import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import Todos from './Todos';

const App = () => {
  return (
    <div>
      <Todos />
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
