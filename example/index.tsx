import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useAsync, createSharedFetch, createSharedState } from '../.';
import { map } from 'rxjs/operators';

interface TodoInterface {
  title: string;
  id: string;
}

const authToken = createSharedState<string | undefined>(undefined);

const fetchJson = createSharedFetch(
  authToken.pipe(
    map(auth => ({
      headers: {
        Auth: 'bearer ' + auth,
      },
    }))
  ),
  response => response.json()
);

const todos = (todoId: string) => {
  return fetchJson(`https://jsonplaceholder.typicode.com/todos/${todoId}`, {
    search: '5',
  }).pipe(map(data => data as TodoInterface));
};

const Todo = ({ id }: { id: string }) => {
  const { result, pending } = useAsync(
    async observe => {
      const res = await observe(todos(id));
      return res;
    },
    [id]
  );
  if (pending || !result) {
    return <p>Loading</p>;
  }
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
