import React, { useCallback, useState } from 'react';
import { Meta, Story } from '@storybook/react';
import { shareAsyncState } from '../src';

type Todo = {
  id: number;
  body: string;
  completed: boolean;
};

const todos$ = shareAsyncState<Todo[]>([], (oldState, newState) => {
  return newState;
});

let todoCount = 0;
function addTodo(body: string) {
  return todos$.dispatch(todos => [
    ...todos,
    { id: todoCount++, body, completed: false },
  ]);
}

function removeTodo(id: number) {
  return todos$.dispatch(todos => todos.filter(t => t.id !== id));
}

function completeTodo(id: number) {
  return todos$.dispatch(todos =>
    todos.map(t => {
      if (id === t.id) {
        return {
          ...t,
          completed: true,
        };
      }
      return t;
    })
  );
}

function AsyncComponent({ input }: any) {
  const todos = todos$.useSubscribe();
  const [text, setText] = useState<string>();
  const onSetText = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
    },
    [setText]
  );
  const onAdd = useCallback(() => {
    setText(text => {
      addTodo(text);
      return '';
    });
  }, [setText]);
  return (
    <div>
      <input type="text" value={text} onChange={onSetText} />
      <button onClick={onAdd}>Add</button>
      {todos.map((todo, idx) => (
        <div key={todo.id}>
          {todo.body}
          <button onClick={() => removeTodo(todo.id)}>Remove</button>
          {!todo.completed && (
            <button onClick={() => completeTodo(todo.id)}>Complete</button>
          )}
        </div>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Todo app',
  component: AsyncComponent,
  argTypes: {
    input: {
      control: {
        type: 'text',
      },
    },
    children: {
      control: {
        type: 'text',
      },
    },
  },
  parameters: {
    controls: { expanded: true },
  },
};

export default meta;

const Template: Story<{}> = args => <AsyncComponent input="" {...args} />;

// By passing using the Args format for exported stories, you can control the props for a component for reuse in a test
// https://storybook.js.org/docs/react/workflows/unit-testing
export const Default = Template.bind({});

Default.args = {};
