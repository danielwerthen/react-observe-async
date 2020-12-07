import React from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync, shareAsyncState } from '../src';
import { from, interval } from 'rxjs';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

const inty = interval(1000);
const inty2 = interval(2000);
const shared = shareAsyncState(0, (state, action) => action);
const completed = from([1, 2, 3]);

function AsyncComponent({ input }: any) {
  const { result = [] } = useAsync(
    observe => {
      return Promise.all([
        asyncQuery('Test'),
        observe(inty),
        observe(inty2),
        observe(shared).then(counter => `Counter: ${counter}`),
      ]) as Promise<any[]>;
    },
    [input]
  );
  const { result: result2 = [] } = useAsync(
    observe => {
      return Promise.all([
        observe(shared).then(counter => `Counter: ${counter}`),
        observe(completed),
      ]) as Promise<any[]>;
    },
    [input]
  );
  return (
    <div>
      {result.map((res, idx) => (
        <p key={idx}>{res}</p>
      ))}
      {result2.map((res, idx) => (
        <p key={idx}>{res}</p>
      ))}
      <button onClick={() => shared.dispatch(v => v + 1)}>
        Increase counter
      </button>
    </div>
  );
}

const meta: Meta = {
  title: 'Welcome',
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
