import React, { useState } from 'react';
import { Meta, Story } from '@storybook/react';
import { useAsync } from '../src';
import { PendingBoundary, PendingSequence } from '../src/pending';

function asyncQuery(text: string, timeout: number): Promise<string> {
  return new Promise(resolve =>
    setTimeout(resolve, timeout, `Response for: ${text}`)
  );
}

function Foobar({ input, timeout }: any) {
  const { result, refresh } = useAsync(() => {
    return asyncQuery('Test' + input, timeout);
  }, [timeout]);
  return <div onClick={refresh}>Result: {result}</div>;
}

function AsyncComponent({ input }: any) {
  const [result, setState] = useState(0);
  const refresh = () => setState(c => c + 1);
  return (
    <>
      <p onClick={refresh}>Render count: {result}</p>
      <PendingSequence>
        <PendingBoundary>
          <p>
            With pending sequence all the async elements will appear in a strict
            sequence. Even if some elements completes more quickly then the once
            above them
          </p>
        </PendingBoundary>
        <PendingBoundary>
          <Foobar input="text" timeout={1000} />
        </PendingBoundary>
        <PendingBoundary>
          <Foobar input="text2" timeout={100} />
        </PendingBoundary>
        <PendingBoundary>
          <Foobar input="text3" timeout={3000} />
        </PendingBoundary>
      </PendingSequence>
    </>
  );
}

const meta: Meta = {
  title: 'Pending',
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
