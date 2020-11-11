import React from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';
import { interval } from 'rxjs';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

const inty = interval(1000);
const inty2 = interval(2000);

function AsyncComponent({ input }: any) {
  const { result = [] } = useAsync(
    observe => {
      return Promise.all([
        asyncQuery('Test'),
        observe(inty),
        observe(inty2),
      ]) as Promise<any[]>;
    },
    [input]
  );
  return (
    <div>
      {result.map((res, idx) => (
        <p key={idx}>{res}</p>
      ))}
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
