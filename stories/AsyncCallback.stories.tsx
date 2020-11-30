import React, { useMemo } from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsyncCallback } from '../src';

function asyncQuery(text: string): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, 500, `Response for: ${text}`)
  );
}

function StepsComponent({ input }: any) {
  const { pending, result, execute } = useAsyncCallback(async () => {
    console.log('Execute');
    return await asyncQuery('Foobar');
  }, [input]);
  const steps = useMemo(() => [], []);
  steps.push([pending, result]);
  return (
    <div>
      <button onClick={execute}>Execute</button>
      <pre>{JSON.stringify(steps, null, '  ')}</pre>
    </div>
  );
}

const meta: Meta = {
  title: 'useAsyncCallback',
  component: StepsComponent,
  argTypes: {},
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
