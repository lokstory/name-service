import './App.css';
import { Button, Form, Row } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import Web3 from 'web3';
import { useEffect, useState } from 'react';
import * as yup from 'yup';
import { useFormik } from 'formik';
import NameStorageContract from './assets/NameStorage.json';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';

const nameContractInfo = {
  id: process.env.REACT_APP_NAME_CONTRACT_NETWORK_ID,
  address: process.env.REACT_APP_NAME_CONTRACT_ADDRESS
};

const MySwal = withReactContent(Swal);

/**
 * Enable wallet, return web3 when available
 */
const getWeb3 = async () => {
  await window.ethereum?.request({ method: 'eth_requestAccounts' });

  const provider = window.ethereum || window.web3 || null;

  return provider ? new Web3(provider) : null;
};

/**
 * Fetch chain list, then return chain map.
 * Key: chain id in string
 */
const getChainMap = async () => {
  const response = await fetch('https://chainid.network/chains.json');
  const list = await response.json();

  const chainMap = new Map();

  list?.forEach(item => {
    chainMap.set(item.chainId.toString(), item);
  });

  return chainMap;
};

/**
 * Switch network when it's different from contract's network
 * @return {Promise<boolean|*>} Whether network is valid
 */
const checkSwitchNetwork = async (web3, chainId) => {
  if (web3 && chainId && chainId !== nameContractInfo.id) {
    try {
      const result = await window.ethereum?.request({
        method: 'wallet_switchEthereumChain', params: [{ chainId: web3.utils.toHex(nameContractInfo.id) }]
      });

      console.log('switch network result:', result);
      return result;
    } catch (error) {
      console.log('switch network error:', error);
      return false;
    }
  }

  return true;
};

/**
 * Generate names.
 * TODO: It's just a quick solution by generating suffix texts, and exclude duplicated names.
 *  1. Name generating setting.
 *  2. Create a struct in the smart contract for storing existing characters,
 *   but the performance or the gas fee might be a problem.
 * @return {Promise<*[]>} Array of names
 */
const generateNames = async ({ nameContract, name, accounts }) => {
  try {
    const names = [...Array(10)].map((_, i) => {
      // Remove prefix 0.
      const text = Math.random().toString(36).substring(2);

      // Suffix min length: 2
      const suffix = text.substring(0, 2 + Math.min(i, text.length - 2));

      return `${name}_${suffix}`;
    });

    // Exclude duplicated names
    const results = await Promise.all(names
      .map(async (item) => {
        return isNameExists({ nameContract, name: item, accounts });
      }));

    return names.filter((v, index) => !results[index]);
  } catch (e) {
    console.log('generate names error:', e);

    return [];
  }
};

/**
 * Check whether the name does exist
 */
const isNameExists = async ({ nameContract, accounts, name }) => {
  return await nameContract.methods.isNameExists(name)
    .call({ from: accounts[0] });
};

/**
 * Refresh the name of the account
 * @param nameContract Name storage contract
 * @param accounts Account addresses
 * @param setHeaderNameAction A function to update the name in the header
 * @return {Promise<void>}
 */
const refreshName = async (nameContract, accounts, setHeaderNameAction) => {
  const nextName = nameContract && accounts?.length ? await nameContract.methods
    .readName()
    .call({ from: accounts[0] }) : '';

  console.log('refresh name:', nextName);

  setHeaderNameAction(nextName);
};

/**
 * Save name to the contract
 * @param nameContract Name storage contract
 * @param accounts Account addresses
 * @param name Name
 * @param setFormNameAction A function to update the name to the form
 * @return {Promise<boolean>} Return true when successful transaction
 */
const saveName = async ({ nameContract, accounts, name, setFormNameAction }) => {
  const exists = await isNameExists({ nameContract, accounts, name });

  if (!exists) {
    const transaction = await nameContract.methods.setName(name).send({ from: accounts[0] });

    return !!(transaction?.transactionHash?.length);
  }

  let suggestionNames = [];

  await MySwal.fire({
    title: `Name ${name} does already exists`,
    icon: 'error',
    allowOutsideClick: false,
    didOpen: async () => {
      try {
        MySwal.showLoading();

        suggestionNames = await generateNames({ nameContract, name, accounts });
      } finally {
        MySwal.hideLoading();
      }
    }
  });

  if (!suggestionNames?.length) return false;

  const options = suggestionNames.reduce((accumulator, value) => {
    return { ...accumulator, [value]: value };
  }, {});

  const selectResult = await MySwal.fire({
    title: `Choose a suggested name`,
    input: 'select',
    inputOptions: options,
    showCancelButton: true
  });

  if (selectResult?.isConfirmed && selectResult?.value?.length) {
    setFormNameAction(selectResult.value);
  }

  return false;
};

const App = () => {
  const [web3, setWeb3] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [chainMap, setChainMap] = useState(new Map());
  const [network, setNetwork] = useState('');
  const [chainId, setChainId] = useState();
  const [balance, setBalance] = useState(null);
  const [nameContract, setNameContract] = useState(null);
  const [name, setName] = useState();

  // Form
  const formik = useFormik({
    initialValues: {
      name: ''
    }, validationSchema: yup.object({
      name: yup.string()
        .required()
    }),
    onSubmit: async (values, { setSubmitting, setValues }) => {
      try {
        const isNetworkAvailable = await checkSwitchNetwork(web3, chainId);

        if (!isNetworkAvailable || !nameContract || !accounts?.length) return;

        const ok = await saveName({
          web3,
          chainId,
          nameContract,
          accounts,
          name: values.name,
          setFormNameAction: (value) => {
            setValues({ ...values, name: value });
          }
        });

        if (ok) {
          await refreshName(nameContract, accounts, setName);
        }
      } catch (e) {
        console.log('update name error:', e);
      } finally {
        setSubmitting(false);
      }
    }
  });

  const updateBalance = async () => {
    const wei = accounts?.length ? await web3?.eth.getBalance(accounts[0]) : 0;
    const ether = wei ? Web3.utils.fromWei(wei) : 0;

    console.log(`balance: ${wei}, ether: ${ether}`);

    setBalance(ether);
  };

  // Init once
  useEffect(() => {
    (async () => {
      const nextChainMap = await getChainMap();
      setChainMap(nextChainMap);

      const nextWeb3 = await getWeb3();
      setWeb3(nextWeb3);

      const nextChainId = await nextWeb3?.eth?.getChainId();

      setAccounts(await nextWeb3?.eth?.getAccounts());
      setChainId(nextChainId?.toString() || null);

      // Listen accounts changed
      window.ethereum?.on('accountsChanged', async (accounts) => {
        console.log('changed accounts:', accounts);

        setAccounts(accounts);
      });

      // Listen network changed
      window.ethereum?.on('networkChanged', (networkId) => {
        console.log('changed network:', networkId);

        setChainId(networkId);
      });
    })();
  }, []);

  // Update network
  useEffect(() => {
    if (!chainMap || !chainId) return;

    const networkName = chainId && chainMap ? chainMap.get(chainId)?.name : '';

    setNetwork(networkName);
  }, [chainMap, chainId]);

  // Check switch network when chain id changed
  useEffect(() => {
    (async () => {
      await checkSwitchNetwork(web3, chainId);
    })();
  }, [web3, chainId]);

  useEffect(() => {
    (async () => {
      const contract = web3 && chainId && nameContractInfo.id == chainId ? new web3.eth.Contract(NameStorageContract.abi, nameContractInfo.address) : null;

      setNameContract(contract);
    })();
  }, [web3, chainId]);

  useEffect(() => {
    (async () => {
      await refreshName(nameContract, accounts, setName);
    })();
  }, [nameContract, accounts]);

  useEffect(() => {
    if (!web3 || !accounts || !chainId) return;

    (async () => {
      await updateBalance();
    })();
  }, [web3, accounts, chainId]);

  return <div className='App'>
    <header className='App-header'>
      <button className='Header-item Red'>
        <div>Network</div>
        <div>{network}</div>
      </button>
      <div className='Header-item Green mt-3'>
        <div>Balance</div>
        <div>{balance}</div>
      </div>
      <button className='Header-item Purple mt-3'>
        <div>Name</div>
        <div>{name}</div>
      </button>
    </header>
    <main className='App-content'>
      <Form className='Form-container' noValidate onSubmit={formik.handleSubmit} autoComplete='off'>
        <Row>
          <Form.Group className='position-relative' controlId='formName111'>
            <Form.Label>Name</Form.Label>
            <Form.Control
              type='text'
              placeholder='Enter a name'
              name='name'
              value={formik.values.name}
              onChange={formik.handleChange}
              isInvalid={!!formik.errors.name} />
            <Form.Control.Feedback type='invalid' tooltip>
              {formik.errors?.name}
            </Form.Control.Feedback>
          </Form.Group>
        </Row>
        <Button variant='primary' type='submit' size='lg' className='mt-5' disabled={formik.isSubmitting}>
          Submit
        </Button>
      </Form>
    </main>
  </div>;
};

export default App;
