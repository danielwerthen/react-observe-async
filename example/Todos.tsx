import * as React from 'react';
import { fromFetch } from 'rxjs/fetch';
import { useAsync } from '../src';
import UserAvatar from './UserAvatar';

interface TodoInterface {
  title: string;
  id: number;
  userId: number;
  completed: boolean;
}

function shuffle(array) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

export default function Todos() {
  const { result: todos = [], refresh, pending } = useAsync(async observe => {
    const todos = await observe(
      fromFetch('https://jsonplaceholder.typicode.com/todos/', {
        selector: response => response.json() as Promise<TodoInterface[]>,
      })
    );
    await new Promise(res => setTimeout(res, 100 + Math.random() * 900));
    return shuffle(todos);
  }, []);
  return (
    <div>
      <div className="button-group">
        <button onClick={refresh} disabled={pending}>
          Refresh list
        </button>
      </div>
      {todos.map(todo => (
        <div key={todo.id} className="todo-list-item">
          <UserAvatar userId={todo.userId} />
          <p>{todo.title}</p>
        </div>
      ))}
    </div>
  );
}
