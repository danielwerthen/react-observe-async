import 'react-app-polyfill/ie11';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {
  createSharedFetch,
  asyncState,
  useAsync,
  useAsyncCallback,
} from '../src/index';
import { map } from 'rxjs/operators';

interface TodoInterface {
  title: string;
  id: string;
}

const authToken = asyncState<string | undefined>(undefined);
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

const Sycher = React.memo(function Sycher() {
  const { pending, result, execute } = useAsyncCallback(async () => {
    await new Promise(res => setTimeout(res, 1000));
    return Math.random();
  }, []);
  console.log(JSON.stringify({ result, pending }, null, '  '));
  return (
    <button onClick={execute} disabled={pending}>
      Click for random {pending ? 'Loading' : result}
    </button>
  );
});

let c = 0;

const Thing = () => {
  const [state, setState] = React.useState(0);
  const { result: body } = useAsync(async observe => {
    const { result: todo } = await observe(todos('1'));
    return `Todo name ${todo?.title}, iterator: ${c++}`;
  }, []);
  return (
    <div>
      <Sycher />
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
