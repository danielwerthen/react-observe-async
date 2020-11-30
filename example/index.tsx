import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createSharedFetch, syncState, useAsync } from '../.';
import { map } from 'rxjs/operators';

interface TodoInterface {
  title: string;
  id: string;
}

const authToken = syncState<string | undefined>(undefined);
const init = authToken.pipe(
  map(auth => ({
    headers: {
      Auth: 'bearer ' + auth,
    },
  }))
);

const todos = createSharedFetch(
  init,
  (todoId: string) => `https://jsonplaceholder.typicode.com/todos/${todoId}`,
  response => response.json() as Promise<TodoInterface>
);

const Todo = ({ id }: { id: string }) => {
  const { result, pending } = todos(id).useSubscribe();
  if (pending || !result) {
    return <p>Loading</p>;
  }
  return (
    <p>
      {result.id}: {result.title}
    </p>
  );
};

let c = 0;

const Thing = () => {
  const [state, setState] = React.useState(0);
  const { result: body } = useAsync(async observe => {
    const { result: todo } = await observe(todos('1'));
    return `Todo name ${todo?.title}, iterator: ${c++}`;
  }, []);
  return (
    <div>
      <button onClick={() => setState(c => c + 1)}>Click me</button>
      <button onClick={() => todos('1').refresh()}>Click me</button>
      {body}
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
