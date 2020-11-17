import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useAsync, createSharedObservable } from '../.';
import { fromFetch } from 'rxjs/fetch';
import { map } from 'rxjs/operators';

const todos = createSharedObservable<string, any>({
  factory: (todoId: string) => {
    return fromFetch(
      `https://jsonplaceholder.typicode.com/todos/${todoId}`
    ).pipe(map(res => res.json()));
  },
  getKey: todoId => todoId,
});

const Todo = ({ id }: { id: string }) => {
  const { result = {}, pending } = useAsync(
    async observe => {
      return observe(todos(id));
    },
    [id]
  );
  if (pending) {
    return <p>Loading</p>;
  }
  console.log('Rendering', result.id);
  return (
    <p>
      {result.id}: {result.title}
    </p>
  );
};

const Thing = () => {
  const [state, setState] = React.useState(0);
  return (
    <div>
      <button onClick={() => setState(c => c + 1)}>Click me</button>
      <button onClick={() => todos.refresh('1')}>Click me</button>
      {new Array(state % 2 === 0 ? 100 : 0).fill(0).map((_v, idx) => (
        <Todo key={idx} id={Math.round(Math.random() * 2 + 1).toString()} />
      ))}
    </div>
  );
};

const App = () => {
  return (
    <div>
      <Thing />
    </div>
  );
};

ReactDOM.render(<App />, document.getElementById('root'));
