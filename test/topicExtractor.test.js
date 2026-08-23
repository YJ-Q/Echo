import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLearningTopic } from '../src/services/topicExtractor.js';

test('extractLearningTopic keeps clean topics after learning cues', () => {
  assert.equal(extractLearningTopic('我想学 Node.js，但是总在开始前拖延。'), 'Node.js');
  assert.equal(extractLearningTopic('我还是想学 TypeScript，但总在真正开始前犹豫。'), 'TypeScript');
  assert.equal(extractLearningTopic('teach me Python because I need it for work'), 'Python');
});

test('extractLearningTopic falls back when the learning cue has no real topic', () => {
  assert.equal(extractLearningTopic('我想学'), '这件事');
  assert.equal(extractLearningTopic('想学'), '这件事');
  assert.equal(extractLearningTopic('teach me'), '这件事');
  assert.equal(extractLearningTopic('学习'), '这件事');
});

test('extractLearningTopic normalizes common technical aliases', () => {
  assert.equal(extractLearningTopic('我想学 js'), 'JavaScript');
  assert.equal(extractLearningTopic('想学 TS，而且最近一直拖延'), 'TypeScript');
  assert.equal(extractLearningTopic('learn nodejs but I keep postponing it'), 'Node.js');
});

test('extractLearningTopic removes light filler around topics', () => {
  assert.equal(extractLearningTopic('帮我学习一下关于 闭包，因为我总是看不懂'), '闭包');
  assert.equal(extractLearningTopic('我想学一个 React 小项目'), 'React 小项目');
  assert.equal(extractLearningTopic('学习一下怎么 CSS Grid'), 'CSS Grid');
});
