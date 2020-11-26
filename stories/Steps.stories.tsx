import React, { useMemo } from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

function StepsComponent({ input }: any) {
  const result = useAsync(
    observe => {
      return Promise.all([asyncQuery('Test')]) as Promise<any[]>;
    },
    [input]
  );
  const steps = useMemo(() => [], []);
  steps.push(result);
  return (
    <div>
      {steps.map((res, idx) => (
        <pre key={idx}>{JSON.stringify(res)}</pre>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Steps',
  component: StepsComponent,
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

const Template: Story<{}> = args => <StepsComponent input="" {...args} />;

// By passing using the Args format for exported stories, you can control the props for a component for reuse in a test
// https://storybook.js.org/docs/react/workflows/unit-testing
export const Default = Template.bind({});

Default.args = {};
