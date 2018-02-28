const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const getBlockNumber = require('@aragon/test-helpers/blockNumber')(web3)
const timeTravel = require('@aragon/test-helpers/timeTravel')(web3)
const getBalance = require('@aragon/test-helpers/balance')(web3);
const namehash = require('eth-ens-namehash').hash
const keccak256 = require('js-sha3').keccak_256

const FIFSResolvingRegistrar = artifacts.require('@aragon/id/contracts/FIFSResolvingRegistrar')
//const Kernel = artifacts.require('Kernel')
//const ACL = artifacts.require('ACL')
//const MiniMeTokenFactory = artifacts.require('@aragon/os/contracts/lib/minime/MiniMeTokenFactory')
//const MiniMeToken = artifacts.require('@aragon/os/contracts/lib/minime/MiniMeToken')
//const EtherToken = artifacts.require('@aragon/os/contracts/common/EtherToken.sol')

const { encodeCallScript, EMPTY_SCRIPT } = require('@aragon/test-helpers/evmScript')
const ExecutionTarget = artifacts.require('ExecutionTarget')

const Voting = artifacts.require('Voting')

const apps = ['finance', 'token-manager', 'vault', 'voting']
const appIds = apps.map(app => namehash(require(`@aragon/apps-${app}/arapp`).appName))

const DemocracyTemplate = artifacts.require('DemocracyTemplate')

const getContract = name => artifacts.require(name)
const pct16 = x => new web3.BigNumber(x).times(new web3.BigNumber(10).toPower(16))
const newRepo = async (apm, name, acc, contract, owner) => {
    const c = await artifacts.require(contract).new()
    return await apm.newRepoWithVersion(name, acc, [1, 0, 0], c.address, '0x1245', { from: owner})
}
const getEventResult = (receipt, event, param) => receipt.logs.filter(l => l.event == event)[0].args[param]
const getEnsDeployResult = receipt => getEventResult(receipt, 'DeployENS', 'ens')
const getApmDeployResult = receipt => getEventResult(receipt, 'DeployAPM', 'apm')
const getRepoFromLog = receipt => getEventResult(receipt, 'NewRepo', 'repo')
const createdVoteId = receipt => getEventResult(receipt, 'StartVote', 'voteId')
const getAppProxy = (receipt, id) => receipt.logs.filter(l => l.event == 'InstalledApp' && l.args.appId == id)[0].args.appProxy

//TODO
//const AppProxyUpgradeable = artifacts.require('AppProxyUpgradeable')

contract('Beta Base Template', accounts => {
    let ensFactory, ens, apmFactory, registry, baseDeployed, baseAddrs, dao, acl, daoFactory = {}, etherToken, minimeFac, template, voting, executionTarget = {}
    let aragonId, daoAddress, tokenAddress
    const ensOwner = accounts[0]
    const apmOwner = accounts[1]
    const repoDev  = accounts[2]
    const notOwner = accounts[5]
    const holder19 = accounts[6]
    const holder31 = accounts[7]
    const holder50 = accounts[8]
    const nonHolder = accounts[9]
    const neededSupport = pct16(50)
    const minimumAcceptanceQuorum = pct16(20)
    const votingTime = 5000

    before(async () => {
        const bases = ['APMRegistry', 'Repo', 'ENSSubdomainRegistrar']
        baseDeployed = await Promise.all(bases.map(c => getContract(c).new()))
        baseAddrs = baseDeployed.map(c => c.address)

        ensFactory = await getContract('ENSFactory').new()

        const regFact = await getContract('EVMScriptRegistryFactory').new()
        const regFactAddress = regFact.address

        const kernelBase = await getContract('Kernel').new()
        const aclBase = await getContract('ACL').new()
        daoFactory = await getContract('DAOFactory').new(kernelBase.address, aclBase.address, regFactAddress)
        // TODO: For some reason APM fails if created from a DAO Factory with EVM Script Registry Factory (so we create another one here without it):
        const daoFactoryNoReg = await getContract('DAOFactory').new(kernelBase.address, aclBase.address, '0x0')
        const receiptEns = await ensFactory.newENS(ensOwner)
        ens = getContract('ENS').at(getEnsDeployResult(receiptEns))

        apmFactory = await getContract('APMRegistryFactory').new(daoFactoryNoReg.address, ...baseAddrs, ens.address, '0x0')
        ens.setSubnodeOwner(namehash('eth'), '0x'+keccak256('aragonpm'), apmFactory.address, { from: ensOwner })

        etherToken = await getContract('EtherToken').new()
        minimeFac = await getContract('MiniMeTokenFactory').new()
        const publicResolver = getContract('PublicResolver').at(await ens.resolver(namehash('resolver.eth')))
        aragonId = await getContract('FIFSResolvingRegistrar').new(ens.address, publicResolver.address, namehash('aragonid.eth'))
        await ens.setSubnodeOwner(namehash('eth'), '0x'+keccak256('aragonid'), aragonId.address, { from: ensOwner })
        await aragonId.register('0x'+keccak256('owner'), ensOwner)

        const receiptApm = await apmFactory.newAPM(namehash('eth'), '0x'+keccak256('aragonpm'), apmOwner)
        const apmAddr = getApmDeployResult(receiptApm)
        registry = getContract('APMRegistry').at(apmAddr)

        await newRepo(registry, 'voting', repoDev, 'Voting', apmOwner)
        await newRepo(registry, 'finance', repoDev, 'Finance', apmOwner)
        await newRepo(registry, 'token-manager', repoDev, 'TokenManager', apmOwner)
        await newRepo(registry, 'vault', repoDev, 'Vault', apmOwner)
    //})

    //beforeEach(async () => {
        // create Democracy Template
        template = await DemocracyTemplate.new(daoFactory.address, minimeFac.address, registry.address, etherToken.address, aragonId.address, appIds)
        const holders = [holder19, holder31, holder50]
        const stakes = [19*10**18, 31*10**18, 50*10**18]
        // create Token
        const receiptToken = await template.newToken('DemocracyToken', 'DTT')
        tokenAddress = getEventResult(receiptToken, 'DeployToken', 'token')
        // create Instance
        const receiptInstance = await template.newInstance('DemocracyDao', holders, stakes, neededSupport, minimumAcceptanceQuorum, votingTime)
        //console.log(receiptInstance.logs)
        daoAddress = getEventResult(receiptInstance, 'DeployInstance', 'dao')
        dao = getContract('Kernel').at(daoAddress)
        // generated Voting app
        const votingProxyAddress = getAppProxy(receiptInstance, appIds[3])
        voting = Voting.at(votingProxyAddress)
    })

    it('creates and initializes a DAO with its Token', async() => {
        assert.notEqual(tokenAddress, '0x0', 'Token not generated')
        assert.notEqual(daoAddress, '0x0', 'Instance not generated')
        assert.equal((await voting.supportRequiredPct()).toString(), neededSupport.toString())
        assert.equal((await voting.minAcceptQuorumPct()).toString(), minimumAcceptanceQuorum.toString())
        assert.equal((await voting.voteTime()).toString(), votingTime.toString())
        // check that it's initialized and cant not be initialized again
        return assertRevert(async () => {
            await voting.initialize(tokenAddress, neededSupport, minimumAcceptanceQuorum, votingTime)
        })
    })

    context('creating vote', () => {
        let voteId = {}
        let script

        beforeEach(async () => {
            executionTarget = await ExecutionTarget.new()
            //console.log(executionTarget)
            const action = { to: executionTarget.address, calldata: executionTarget.contract.execute.getData() }
            script = encodeCallScript([action, action])
            voteId = createdVoteId(await voting.newVote(script, 'metadata', { from: nonHolder }))
        })

        it('has correct state', async() => {
            const [isOpen, isExecuted, creator, startDate, snapshotBlock, minQuorum, y, n, totalVoters, execScript] = await voting.getVote(voteId)

            assert.isTrue(isOpen, 'vote should be open')
            assert.isFalse(isExecuted, 'vote should be executed')
            assert.equal(creator, nonHolder, 'creator should be correct')
            assert.equal(snapshotBlock, await getBlockNumber() - 1, 'snapshot block should be correct')
            assert.deepEqual(minQuorum, minimumAcceptanceQuorum, 'min quorum should be app min quorum')
            assert.equal(y, 0, 'initial yea should be 0')
            assert.equal(n, 0, 'initial nay should be 0')
            assert.equal(totalVoters.toString(), new web3.BigNumber(100*10**18).toString(), 'total voters should be 100')
            assert.equal(execScript, script, 'script should be correct')
            assert.equal(await voting.getVoteMetadata(voteId), 'metadata', 'should have returned correct metadata')
        })

        it('holder can vote', async () => {
            await voting.vote(voteId, false, true, { from: holder31 })
            const state = await voting.getVote(voteId)

            assert.equal(state[7].toString(), new web3.BigNumber(31*10**18).toString(), 'nay vote should have been counted')
        })

        it('holder can modify vote', async () => {
            await voting.vote(voteId, true, true, { from: holder31 })
            await voting.vote(voteId, false, true, { from: holder31 })
            await voting.vote(voteId, true, true, { from: holder31 })
            const state = await voting.getVote(voteId)

            assert.equal(state[6].toString(), new web3.BigNumber(31*10**18).toString(), 'yea vote should have been counted')
            assert.equal(state[7], 0, 'nay vote should have been removed')
        })

        it('throws when non-holder votes', async () => {
            return assertRevert(async () => {
                await voting.vote(voteId, true, true, { from: nonHolder })
            })
        })

        it('throws when voting after voting closes', async () => {
            await timeTravel(votingTime + 1)
            return assertRevert(async () => {
                await voting.vote(voteId, true, true, { from: holder31 })
            })
        })

        it('can execute if vote is approved with support and quorum', async () => {
            await voting.vote(voteId, true, true, { from: holder31 })
            await voting.vote(voteId, false, true, { from: holder19 })
            await timeTravel(votingTime + 1)
            await voting.executeVote(voteId)
            assert.equal(await executionTarget.counter(), 2, 'should have executed result')
        })

        it('cannot execute vote if not enough quorum met', async () => {
            await voting.vote(voteId, true, true, { from: holder19 })
            await timeTravel(votingTime + 1)
            return assertRevert(async () => {
                await voting.executeVote(voteId)
            })
        })

        it('cannot execute vote if not support met', async () => {
            await voting.vote(voteId, false, true, { from: holder31 })
            await voting.vote(voteId, false, true, { from: holder19 })
            await timeTravel(votingTime + 1)
            return assertRevert(async () => {
                await voting.executeVote(voteId)
            })
        })
    })

    /*
    it('can change minimum acceptance quorum', async () => {
        const receipt = await voting.changeMinAcceptQuorumPct(1)
        const events = receipt.logs.filter(x => x.event == 'ChangeMinQuorum')

        assert.equal(events.length, 1, 'should have emitted ChangeMinQuorum event')
        assert.equal(await voting.minAcceptQuorumPct(), 1, 'should have change acceptance quorum')
    })
     */

    /*
    context('finance access', () => {
        it('transfers funds', () => {
            const action = { to: executionTarget.address, calldata: executionTarget.contract.execute.getData() }
            const script = encodeCallScript([action, action])
            //const voteId = createdVoteId(await voting.newVote(script, 'metadata', { from: holder50 }))
        })
    })
     */

})
